use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, UNIX_EPOCH};

/// How long an image-rename command may run before it is killed and the
/// original filename is kept.
const RENAME_COMMAND_TIMEOUT: Duration = Duration::from_secs(8);

/// Check if a character is safe for use in filenames (alphanumeric, dot, dash, underscore).
fn is_safe_filename_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '.' | '-' | '_')
}

/// Sanitize a filename by replacing unsafe characters with underscores.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if is_safe_filename_char(c) { c } else { '_' })
        .collect()
}

/// Image file extensions considered valid for drag-drop import.
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "tiff"];

/// Source extensions that are transcoded to WebP on paste. Everything else
/// (gif, svg, already-webp, …) is stored as-is.
const WEBP_SOURCE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg"];

/// WebP encode quality (0–100) for pasted images.
const WEBP_QUALITY: f32 = 80.0;

/// Lowercased file extension of a filename, or empty string when absent.
fn extension_of(filename: &str) -> String {
    Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

/// Replace a filename's extension with `webp`.
fn with_webp_extension(filename: &str) -> String {
    Path::new(filename)
        .with_extension("webp")
        .to_string_lossy()
        .to_string()
}

/// Decode raw image bytes and re-encode them as lossy WebP at [`WEBP_QUALITY`].
fn encode_webp(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("Failed to decode image: {}", e))?;
    let encoder = webp::Encoder::from_image(&img).map_err(|e| format!("Failed to prepare WebP encoder: {}", e))?;
    Ok(encoder.encode(WEBP_QUALITY).to_vec())
}

/// Determine the bytes and filename to persist for a pasted image, transcoding
/// PNG/JPEG to WebP and falling back to the original on any decode/encode error.
fn prepare_payload(filename: &str, bytes: Vec<u8>) -> (String, Vec<u8>) {
    if !WEBP_SOURCE_EXTENSIONS.contains(&extension_of(filename).as_str()) {
        return (filename.to_string(), bytes);
    }
    match encode_webp(&bytes) {
        Ok(webp_bytes) => (with_webp_extension(filename), webp_bytes),
        Err(_) => (filename.to_string(), bytes),
    }
}

/// Prepare the attachments directory and generate a unique target path.
fn prepare_attachment_path(vault_path: &str, filename: &str) -> Result<std::path::PathBuf, String> {
    let attachments_dir = Path::new(vault_path).join("attachments");
    fs::create_dir_all(&attachments_dir)
        .map_err(|e| format!("Failed to create attachments directory: {}", e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let unique_name = format!("{}-{}", timestamp, sanitize_filename(filename));
    Ok(attachments_dir.join(unique_name))
}

/// Save an uploaded image to the vault's attachments directory.
/// Returns the absolute path to the saved file.
pub fn save_image(vault_path: &str, filename: &str, data: &str) -> Result<String, String> {
    use base64::Engine;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("Invalid base64 data: {}", e))?;

    let (target_filename, payload) = prepare_payload(filename, bytes);
    let target_path = prepare_attachment_path(vault_path, &target_filename)?;

    fs::write(&target_path, payload).map_err(|e| format!("Failed to write image: {}", e))?;

    Ok(target_path.to_string_lossy().to_string())
}

/// Copy an image file from a source path into the vault's attachments directory.
/// Used for Tauri native drag-drop which provides absolute file paths.
/// Returns the absolute path to the saved file.
pub fn copy_image_to_vault(vault_path: &str, source_path: &str) -> Result<String, String> {
    let source = Path::new(source_path);
    if !source.exists() {
        return Err(format!("Source file does not exist: {}", source_path));
    }

    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("Not a supported image format: {}", source_path));
    }

    let filename = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image");
    let target_path = prepare_attachment_path(vault_path, filename)?;

    fs::copy(source, &target_path).map_err(|e| format!("Failed to copy image: {}", e))?;

    Ok(target_path.to_string_lossy().to_string())
}

/// True when a vault-relative path points inside the `attachments/` directory.
/// Guards [`delete_attachment`] so only attachment files can ever be removed.
fn is_attachments_relative_path(relative_path: &str) -> bool {
    let normalized = relative_path.replace('\\', "/");
    normalized.starts_with("attachments/") && !normalized.split('/').any(|seg| seg == "..")
}

/// Delete an orphaned attachment file. `relative_path` is the vault-relative
/// reference (e.g. `attachments/123-foo.webp`); `path` is its resolved, already
/// boundary-validated absolute location. Refuses paths outside `attachments/`
/// and treats an already-missing file as success (idempotent cleanup).
pub fn delete_attachment(path: &Path, relative_path: &str) -> Result<(), String> {
    if !is_attachments_relative_path(relative_path) {
        return Err(format!(
            "Refusing to delete non-attachment path: {}",
            relative_path
        ));
    }
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to delete attachment: {}", e)),
    }
}

/// Run `command <image_path>`, draining stdout on a reader thread so a chatty
/// script can't deadlock, and killing it if it exceeds [`RENAME_COMMAND_TIMEOUT`].
/// Returns the first non-empty trimmed stdout line.
fn run_name_command(command: &str, image_path: &Path) -> Result<String, String> {
    let program = crate::commands::expand_tilde(command);
    let mut child = Command::new(program.as_ref())
        .arg(image_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start rename command: {}", e))?;

    let mut stdout = child.stdout.take().ok_or("Rename command produced no stdout")?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buffer = String::new();
        let _ = stdout.read_to_string(&mut buffer);
        let _ = tx.send(buffer);
    });

    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| format!("Rename command failed: {}", e))? {
            break status;
        }
        if started.elapsed() > RENAME_COMMAND_TIMEOUT {
            let _ = child.kill();
            return Err("Rename command timed out".to_string());
        }
        std::thread::sleep(Duration::from_millis(50));
    };

    if !status.success() {
        return Err("Rename command exited with a non-zero status".to_string());
    }

    let output = rx.recv_timeout(Duration::from_secs(1)).unwrap_or_default();
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Rename command produced no name".to_string())
}

/// Find a collision-free path in `dir` for `stem.ext`, appending `-1`, `-2`, …
/// when needed. `current` (the file being renamed) never counts as a collision.
fn unique_attachment_path(dir: &Path, stem: &str, ext: &str, current: &Path) -> PathBuf {
    let file_name = |suffix: &str| -> String {
        let base = format!("{}{}", stem, suffix);
        if ext.is_empty() { base } else { format!("{}.{}", base, ext) }
    };

    let first = dir.join(file_name(""));
    if first == current || !first.exists() {
        return first;
    }
    let mut counter = 1;
    loop {
        let candidate = dir.join(file_name(&format!("-{}", counter)));
        if candidate == current || !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

/// Rename `image_path` to `<sanitized raw_name stem>.<original ext>` within the
/// same directory, collision-safe. Returns the new absolute path.
fn rename_attachment_to_stem(image_path: &Path, raw_name: &str) -> Result<String, String> {
    let dir = image_path.parent().ok_or("Image has no parent directory")?;
    let ext = image_path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let stem_source = Path::new(raw_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(raw_name);
    let stem = sanitize_filename(stem_source);
    let stem = stem.trim_matches('_');
    if stem.is_empty() {
        return Err("Suggested name was empty after sanitizing".to_string());
    }

    let target = unique_attachment_path(dir, stem, ext, image_path);
    if target != image_path {
        fs::rename(image_path, &target).map_err(|e| format!("Failed to rename attachment: {}", e))?;
    }
    Ok(target.to_string_lossy().to_string())
}

/// Rename a freshly-saved attachment using an external naming command. The image
/// must live inside the vault's `attachments/` directory. On any failure the
/// original file is left untouched (the caller falls back to its current name).
pub fn rename_attachment_via_command(
    vault_path: &Path,
    image_path: &Path,
    command: &str,
) -> Result<String, String> {
    let vault = vault_path
        .canonicalize()
        .map_err(|e| format!("Invalid vault path: {}", e))?;
    let image = image_path
        .canonicalize()
        .map_err(|e| format!("Image not found: {}", e))?;
    let relative = image
        .strip_prefix(&vault)
        .map_err(|_| "Image is outside the vault".to_string())?;
    if !relative.starts_with("attachments") {
        return Err("Only attachments can be renamed".to_string());
    }

    let raw_name = run_name_command(command, &image)?;
    rename_attachment_to_stem(&image, &raw_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_sanitize_filename_safe_chars() {
        assert_eq!(sanitize_filename("photo.png"), "photo.png");
        assert_eq!(sanitize_filename("my-image_01.jpg"), "my-image_01.jpg");
    }

    #[test]
    fn test_sanitize_filename_unsafe_chars() {
        assert_eq!(sanitize_filename("my file (1).png"), "my_file__1_.png");
        assert_eq!(sanitize_filename("path/to/img.png"), "path_to_img.png");
    }

    #[test]
    fn test_save_image_creates_file() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        let data = base64::engine::general_purpose::STANDARD.encode(b"fake image data");

        let result = save_image(vault_path, "test.png", &data);
        assert!(result.is_ok());

        let saved_path = result.unwrap();
        assert!(std::path::Path::new(&saved_path).exists());
        assert!(saved_path.contains("attachments"));
        assert!(saved_path.contains("test.png"));

        let content = fs::read(&saved_path).unwrap();
        assert_eq!(content, b"fake image data");
    }

    #[test]
    fn test_save_image_creates_attachments_dir() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        let attachments = dir.path().join("attachments");
        assert!(!attachments.exists());

        let data = base64::engine::general_purpose::STANDARD.encode(b"test");
        save_image(vault_path, "img.png", &data).unwrap();
        assert!(attachments.exists());
    }

    /// Encode a tiny solid-color PNG to base64 for conversion tests.
    fn sample_png_base64() -> String {
        use base64::Engine;
        let img = image::RgbaImage::from_pixel(4, 4, image::Rgba([10, 120, 200, 255]));
        let mut bytes: Vec<u8> = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png)
            .unwrap();
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    }

    #[test]
    fn test_save_image_converts_png_to_webp() {
        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();

        let saved_path = save_image(vault_path, "screenshot.png", &sample_png_base64()).unwrap();

        assert!(saved_path.ends_with(".webp"), "expected webp output, got {}", saved_path);
        assert!(!saved_path.contains(".png"));
        let content = fs::read(&saved_path).unwrap();
        assert_eq!(&content[0..4], b"RIFF");
        assert_eq!(&content[8..12], b"WEBP");
    }

    #[test]
    fn test_save_image_passes_through_gif() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        let original = b"GIF89a fake gif bytes";
        let data = base64::engine::general_purpose::STANDARD.encode(original);

        let saved_path = save_image(vault_path, "anim.gif", &data).unwrap();

        assert!(saved_path.ends_with(".gif"));
        assert_eq!(fs::read(&saved_path).unwrap(), original);
    }

    #[test]
    fn test_save_image_passes_through_existing_webp() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        let original = b"already a webp payload";
        let data = base64::engine::general_purpose::STANDARD.encode(original);

        let saved_path = save_image(vault_path, "img.webp", &data).unwrap();

        assert!(saved_path.ends_with(".webp"));
        assert_eq!(fs::read(&saved_path).unwrap(), original);
    }

    #[test]
    fn test_save_image_falls_back_when_png_undecodable() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        let original = b"not really png";
        let data = base64::engine::general_purpose::STANDARD.encode(original);

        let saved_path = save_image(vault_path, "broken.png", &data).unwrap();

        assert!(saved_path.ends_with(".png"));
        assert_eq!(fs::read(&saved_path).unwrap(), original);
    }

    #[test]
    fn test_save_image_invalid_base64() {
        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();

        let result = save_image(vault_path, "test.png", "not-valid-base64!!!");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid base64"));
    }

    #[test]
    fn test_copy_image_to_vault_success() {
        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();

        // Create a source image file
        let source_path = dir.path().join("source.png");
        fs::write(&source_path, b"fake png data").unwrap();

        let result = copy_image_to_vault(vault_path, source_path.to_str().unwrap());
        assert!(result.is_ok());

        let saved_path = result.unwrap();
        assert!(std::path::Path::new(&saved_path).exists());
        assert!(saved_path.contains("attachments"));
        assert!(saved_path.contains("source.png"));

        let content = fs::read(&saved_path).unwrap();
        assert_eq!(content, b"fake png data");
    }

    #[test]
    fn test_copy_image_to_vault_nonexistent_source() {
        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();

        let result = copy_image_to_vault(vault_path, "/nonexistent/photo.png");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn test_copy_image_to_vault_rejects_non_image() {
        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();

        let source_path = dir.path().join("document.pdf");
        fs::write(&source_path, b"fake pdf").unwrap();

        let result = copy_image_to_vault(vault_path, source_path.to_str().unwrap());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not a supported image"));
    }

    fn make_attachment(dir: &TempDir, name: &str) -> std::path::PathBuf {
        let attachments = dir.path().join("attachments");
        fs::create_dir_all(&attachments).unwrap();
        let path = attachments.join(name);
        fs::write(&path, b"data").unwrap();
        path
    }

    #[test]
    fn test_rename_attachment_to_stem_preserves_extension() {
        let dir = TempDir::new().unwrap();
        let image = make_attachment(&dir, "1700000000-image.webp");

        let renamed = rename_attachment_to_stem(&image, "Golden Retriever").unwrap();

        assert!(renamed.ends_with("/Golden_Retriever.webp"), "got {}", renamed);
        assert!(!image.exists());
        assert!(std::path::Path::new(&renamed).exists());
    }

    #[test]
    fn test_rename_attachment_to_stem_avoids_collisions() {
        let dir = TempDir::new().unwrap();
        make_attachment(&dir, "chart.webp");
        let image = make_attachment(&dir, "1700000000-image.webp");

        let renamed = rename_attachment_to_stem(&image, "chart").unwrap();

        assert!(renamed.ends_with("/chart-1.webp"), "got {}", renamed);
    }

    #[test]
    fn test_rename_attachment_to_stem_rejects_empty_name() {
        let dir = TempDir::new().unwrap();
        let image = make_attachment(&dir, "1700000000-image.webp");
        assert!(rename_attachment_to_stem(&image, "   ").is_err());
        assert!(image.exists(), "original is kept when the name is unusable");
    }

    #[cfg(unix)]
    #[test]
    fn test_rename_attachment_via_command_runs_script() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new().unwrap();
        let image = make_attachment(&dir, "1700000000-image.webp");

        let script = dir.path().join("name.sh");
        fs::write(&script, "#!/bin/sh\necho sunset-over-water\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();

        let renamed = rename_attachment_via_command(
            dir.path(),
            &image,
            script.to_str().unwrap(),
        )
        .unwrap();

        assert!(renamed.ends_with("/sunset-over-water.webp"), "got {}", renamed);
        assert!(std::path::Path::new(&renamed).exists());
    }

    #[test]
    fn test_rename_attachment_via_command_rejects_path_outside_attachments() {
        let dir = TempDir::new().unwrap();
        let note = dir.path().join("note.md");
        fs::write(&note, b"keep").unwrap();

        let result = rename_attachment_via_command(dir.path(), &note, "/bin/echo");
        assert!(result.is_err());
        assert!(note.exists());
    }

    #[test]
    fn test_delete_attachment_removes_file() {
        let dir = TempDir::new().unwrap();
        let attachments = dir.path().join("attachments");
        fs::create_dir_all(&attachments).unwrap();
        let file = attachments.join("a.webp");
        fs::write(&file, b"data").unwrap();

        delete_attachment(&file, "attachments/a.webp").unwrap();
        assert!(!file.exists());
    }

    #[test]
    fn test_delete_attachment_missing_file_is_ok() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("attachments/gone.webp");
        assert!(delete_attachment(&file, "attachments/gone.webp").is_ok());
    }

    #[test]
    fn test_delete_attachment_rejects_non_attachment_path() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("note.md");
        fs::write(&file, b"keep me").unwrap();

        let result = delete_attachment(&file, "note.md");
        assert!(result.is_err());
        assert!(file.exists(), "non-attachment files must never be deleted");
    }

    #[test]
    fn test_is_attachments_relative_path_guards_traversal() {
        assert!(is_attachments_relative_path("attachments/a.webp"));
        assert!(!is_attachments_relative_path("attachments/../secrets.md"));
        assert!(!is_attachments_relative_path("other/a.webp"));
    }

    #[test]
    fn test_copy_image_to_vault_accepts_all_extensions() {
        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();

        for ext in &["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "tiff"] {
            let source_path = dir.path().join(format!("img.{}", ext));
            fs::write(&source_path, b"data").unwrap();
            let result = copy_image_to_vault(vault_path, source_path.to_str().unwrap());
            assert!(result.is_ok(), "failed for extension: {}", ext);
        }
    }
}
