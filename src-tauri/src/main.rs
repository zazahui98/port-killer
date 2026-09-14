// release 构建下隐藏 Windows 控制台窗口，避免弹出黑框
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    port_killer_lib::run();
}
