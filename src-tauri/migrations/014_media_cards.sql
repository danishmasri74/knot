-- Card Deck media cards (docs/STORAGE.md): videos, links, files, images and
-- linked pages placed directly on a canvas are now cards in `card_deck`.
-- No table changes; the version stops older Knot, which can't show or edit
-- these cards, from opening the workspace and turning them into notes.
INSERT INTO schema_migrations VALUES(14);
