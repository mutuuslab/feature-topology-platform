#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{io::{BufRead, BufReader, Read}, process::{Child, Command, Stdio}, sync::{mpsc, Arc, Mutex}, time::Duration};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

struct Backend(Mutex<Child>);

fn start_backend(app: &tauri::AppHandle) -> Result<(Child, u16), Box<dyn std::error::Error>> {
    // Tauri의 Windows 확장 경로(\\?\C:\...)는 Node의 진입점 realpath에서 실패할 수 있다.
    let raw_resource = app.path().resource_dir()?;
    let resource = dunce::simplified(&raw_resource).to_path_buf();
    let runtime = resource.join("runtime");
    let raw_data = app.path().app_data_dir()?;
    let data = dunce::simplified(&raw_data).to_path_buf();
    std::fs::create_dir_all(&data)?;
    let mut command = Command::new(runtime.join("node.exe"));
    command.arg("--disable-warning=ExperimentalWarning")
        .arg(runtime.join("backend/dist/main.js"))
        .current_dir(&runtime)
        .env("FF_DESKTOP", "1")
        .env("FF_WEB_DIR", resource.join("ui"))
        .env("FF_DB", data.join("feature-platform.sqlite"))
        .env("FF_EVIDENCE_DIR", data.join("evidence"))
        .env("PORT", "0")
        .env("FF_SEED", "v0.81")
        .env_remove("FF_DATASET")
        .env("GLEO_MODE", "off")
        .env("UNLEASH_MODE", "mock")
        .env("IF_MODE_01", "mock")
        .env("IF_MODE_13", "mock")
        .env("IF_MODE_14", "mock")
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().ok_or("backend stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("backend stderr unavailable")?;
    let errors = Arc::new(Mutex::new(String::new()));
    let captured = Arc::clone(&errors);
    let stderr_thread = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.take(8192).read_to_string(&mut text);
        if let Ok(mut value) = captured.lock() { *value = text; }
    });
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(port) = line.strip_prefix("FF_DESKTOP_READY:").and_then(|s| s.parse::<u16>().ok()) {
                let _ = tx.send(port);
            }
        }
    });
    match rx.recv_timeout(Duration::from_secs(120)) {
        Ok(port) if port > 0 => Ok((child, port)),
        result => {
            let status = child.try_wait().ok().flatten();
            let _ = child.kill();
            let _ = child.wait();
            let _ = stderr_thread.join();
            let details = errors.lock().map(|value| value.clone()).unwrap_or_default();
            Err(format!("로컬 백엔드를 시작하지 못했습니다. 경로: {} ({result:?}, {status:?}) {details}", runtime.display()).into())
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let (mut backend, port) = match start_backend(app.handle()) {
                Ok(started) => started,
                Err(error) => {
                    eprintln!("{error}");
                    if let Ok(dir) = app.path().app_data_dir() {
                        let _ = std::fs::create_dir_all(&dir);
                        let _ = std::fs::write(dir.join("desktop-startup-error.log"), error.to_string());
                    }
                    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("desktop-error.html".into()))
                        .title("Feature Platform")
                        .inner_size(640.0, 420.0)
                        .build()?;
                    return Ok(());
                }
            };
            let origin = format!("http://127.0.0.1:{port}");
            let url = url::Url::parse(&origin)?;
            let allowed_origin = origin.clone();
            if let Err(error) = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Feature Platform")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 680.0)
                .on_navigation(move |url| url.origin().ascii_serialization() == allowed_origin)
                .build() {
                let _ = backend.kill();
                let _ = backend.wait();
                return Err(error.into());
            }
            app.manage(Backend(Mutex::new(backend)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Feature Platform 실행 실패");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(backend) = handle.try_state::<Backend>() {
                if let Ok(mut child) = backend.0.lock() { let _ = child.kill(); let _ = child.wait(); }
            }
        }
    });
}

#[cfg(all(test, windows))]
mod tests {
    use std::path::Path;

    #[test]
    fn windows_extended_path_is_compatible_with_node() {
        let input = Path::new(r"\\?\C:\project\Feature Platform\runtime");
        assert_eq!(dunce::simplified(input), Path::new(r"C:\project\Feature Platform\runtime"));
    }
}
