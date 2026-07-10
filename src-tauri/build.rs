use std::path::Path;
use std::process::Command;

fn git_output(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Resolve the build id stamped into the binary. Prefer `build-id.txt` (written
/// by the Vite build) so the native binary and the frontend bundle carry the
/// *same* stamp; fall back to a git short hash (with a `-dirty` marker) for
/// standalone `cargo` builds and tests where the frontend was not built.
fn resolve_build_commit() -> String {
    if let Ok(contents) = std::fs::read_to_string("build-id.txt") {
        let trimmed = contents.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    match git_output(&["rev-parse", "--short", "HEAD"]) {
        Some(hash) => {
            if git_output(&["status", "--porcelain"]).is_some() {
                format!("{hash}-dirty")
            } else {
                hash
            }
        }
        None => "unknown".to_string(),
    }
}

fn main() {
    // Ensure resource directory exists for the Tauri build.
    // Gitignored and populated by bundle-mcp-server.mjs.
    // Without a placeholder, `tauri build` / `cargo test` fails if the script hasn't run.
    let path = Path::new("resources/mcp-server");
    if !path.exists() {
        std::fs::create_dir_all(path).ok();
        std::fs::write(path.join(".placeholder"), "").ok();
    }

    let build_id = resolve_build_commit();

    // The Vite build writes the rich manifest; ensure a minimal one exists for
    // cargo-only builds (tests, `cargo build`) so the declared bundle resource
    // still resolves. Never overwrite a manifest the Vite build already wrote.
    let manifest = Path::new("build-manifest.json");
    if !manifest.exists() {
        let commit = git_output(&["rev-parse", "HEAD"]).unwrap_or_else(|| "unknown".to_string());
        let json = format!(
            "{{\n  \"buildId\": \"{build_id}\",\n  \"commit\": \"{commit}\",\n  \"source\": \"build.rs-fallback\"\n}}\n"
        );
        std::fs::write(manifest, json).ok();
    }

    println!("cargo:rustc-env=BUILD_COMMIT={build_id}");
    // Re-run when the shared build id or HEAD changes so the stamp stays current.
    if Path::new("build-id.txt").exists() {
        println!("cargo:rerun-if-changed=build-id.txt");
    }
    if Path::new("../.git/HEAD").exists() {
        println!("cargo:rerun-if-changed=../.git/HEAD");
    }

    tauri_build::build()
}
