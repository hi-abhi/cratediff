use crate::{
    components::{comparison_header::ComparisonHeaderMount, navigation::Header},
    views::{
        debug::DebugPage, diff::DiffPage, home::Home, not_found::NotFound, search::SearchPage,
    },
};
use leptos::{html, prelude::*};
use leptos_router::{
    components::{Route, Router, Routes},
    path,
};

#[component]
pub fn App() -> impl IntoView {
    let comparison_mounts = ComparisonHeaderMount {
        identity: NodeRef::<html::Div>::new(),
        versions: NodeRef::<html::Div>::new(),
    };
    provide_context(comparison_mounts);
    view! {
        <Router>
            <div class="app">
                <Header comparison_mounts=comparison_mounts/>
                <main class="container">
                    <Routes fallback=NotFound>
                        <Route path=path!("/") view=Home/>
                        <Route path=path!("/debug") view=DebugPage/>
                        <Route path=path!("/404") view=NotFound/>
                        <Route path=path!("/search/*query") view=SearchPage/>
                        <Route path=path!("/crate/:krate") view=DiffPage/>
                        <Route path=path!("/crate/:krate/:old/:new/*file") view=DiffPage/>
                    </Routes>
                </main>
            </div>
        </Router>
    }
}
