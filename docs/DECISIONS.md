# Decisions

1. **BlockSuite 0.19.5**: latest published `@blocksuite/presets` version inspected during implementation. Match `blocks` and `store` to it. Current online API reference has moved ahead, so checked the shipped TypeScript source and public exports as well as the official quick-start. Do not mix new store versions into this integration.
2. **React 18.3.1**: matches the icon package's supported peer range. `@blocksuite/icons` is overridden to 2.1.75 because the later 2.2.17 release removes an export required by 0.19.5. pnpm-lock.yaml captures exact transitive versions.
3. **Explicit effects registration**: invoke public blocks/presets `effects()` functions once to register custom elements. Importing classes alone does not register editors.
4. **Tauri 2.12.5 and Rust 1.90.0**: current compatible Rust dependency set is fixed by Cargo.lock, toolchain by rust-toolchain.toml. Bundled SQLite avoids machine-level SQLite dependencies.
5. **Snapshot pairs instead of update logs**: atomic, straightforward recovery without log replay/compaction complexity. The tradeoff is increased write cost for large documents. Benchmark before introducing incremental logs.
6. **Copy-based content-addressed attachments**: stable offline originals; hashes determine paths, source IDs preserve BlockSuite references. No destructive cleanup in this release.
7. **Soft deletion**: data remains recoverable in the workspace and backups. No misleading permanent-delete control.
8. **Native recovery before standard exports**: archive preserves internal state, identifiers, and attachments. Markdown/PNG/PDF export controls are not advertised before implementation.
9. **Offline restrictions**: no network services or providers; CSP prevents remote embeds. Installed WebView2 is a prerequisite. Editor fonts use system fallback; optional online-dependent upstream features are not supported.

References inspected: https://blocksuite.io/guide/quick-start, https://github.com/toeverything/blocksuite, https://docs.yjs.dev/, https://v2.tauri.app/, and installed 0.19.5 package sources.
