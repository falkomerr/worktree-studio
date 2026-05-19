import { defineConfig } from "vitepress";

export default defineConfig({
    title: "Worktree Studio",
    description: "CLI and local web UI for git worktree command orchestration.",
    head: [["link", { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }]],
    themeConfig: {
        nav: [
            { text: "Guide", link: "/" },
            { text: "Config", link: "/worktree-studio/config" },
            { text: "Agents", link: "/agents/self-configure" },
        ],
        search: {
            provider: "local",
        },
        sidebar: [
            {
                text: "Worktree Studio",
                items: [
                    { text: "Home", link: "/" },
                    { text: "Overview", link: "/worktree-studio/overview" },
                    { text: "Install", link: "/worktree-studio/install" },
                    { text: "CLI", link: "/worktree-studio/cli" },
                    { text: "GUI", link: "/worktree-studio/gui" },
                    { text: "Bootstrap", link: "/worktree-studio/bootstrap" },
                    { text: "Config", link: "/worktree-studio/config" },
                    { text: "Examples", link: "/worktree-studio/examples" },
                    { text: "Troubleshooting", link: "/worktree-studio/troubleshooting" },
                ],
            },
            {
                text: "Agents",
                items: [
                    { text: "Self Configure", link: "/agents/self-configure" },
                    { text: "Quickstart", link: "/agents/worktree-studio-quickstart" },
                    { text: "Environment contract", link: "/agents/environment-contract" },
                ],
            },
        ],
        socialLinks: [{ icon: "github", link: "https://github.com/falkomerr/worktree-studio" }],
    },
});
