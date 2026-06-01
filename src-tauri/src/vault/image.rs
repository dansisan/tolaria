use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

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
