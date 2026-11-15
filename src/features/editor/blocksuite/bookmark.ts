import { BookmarkBlockService } from "@blocksuite/blocks";
import {
  BlockServiceIdentifier,
  type ExtensionType,
} from "@blocksuite/block-std";
import { queryLinkPreview } from "../../../services/link-preview";

/** Keep the editor's bookmark behavior, replacing its hosted preview endpoint. */
export const BookmarkPreviewSpec: ExtensionType = {
  setup(di) {
    di.override(BlockServiceIdentifier("affine:bookmark"), (provider) => {
      const service = provider.get(BookmarkBlockService);
      service.queryUrlData = queryLinkPreview;
      return service;
    });
  },
};
