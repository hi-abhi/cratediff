mod app;
mod components;
mod data;
mod diff;
mod search;
mod settings;
mod source;
mod views;

fn main() {
    leptos::mount::mount_to_body(app::App);
}
