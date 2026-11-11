// Seed saved block types used before the Links panel for compatibility tests.
export async function placeLegacyReference(page, target, shared = true) {
  await page.evaluate(
    ({ target, shared }) => {
      const editor = document.querySelector(
        ".editor-area affine-editor-container",
      );
      const { doc } = editor;
      const source = doc.collection.meta.docMetas.find(
        (item) => item.id === target || item.title === target,
      );
      if (!source) throw Error(`Unknown reference target: ${target}`);
      const flavour = shared
        ? "affine:embed-synced-doc"
        : "affine:embed-linked-doc";
      const canvas = editor.querySelector("affine-edgeless-root");
      const parent = doc.getBlocksByFlavour(
        canvas ? "affine:surface" : "affine:note",
      )[0].model;
      const { x, y } = canvas?.gfx.viewport.center ?? { x: 0, y: 0 };
      doc.captureSync();
      doc.addBlock(
        flavour,
        {
          pageId: source.id,
          style: shared ? "syncedDoc" : "vertical",
          xywh: `[${x - 182},${y - 195},364,390]`,
        },
        parent,
      );
    },
    { target, shared },
  );
}
