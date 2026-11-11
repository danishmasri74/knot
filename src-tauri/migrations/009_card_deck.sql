CREATE TABLE card_deck (id INTEGER PRIMARY KEY CHECK(id=1), content TEXT NOT NULL);
INSERT INTO card_deck VALUES(1, '{}');
INSERT INTO schema_migrations VALUES(9);
