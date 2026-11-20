# Buffy redesign execution ledger

- Ruling: Increase the screen from 192×120 to 224×136 and move its center from (256, 308) to (256, 279) — the reference has a prominent screen centered higher on a large plush head — cost if wrong: the new expression scale may feel too large in compact overlay mode.
- Ruling: Use the existing writable project checkout after the managed worktree was inaccessible under workspace permissions — this lets the requested implementation proceed without expanding filesystem access — cost if wrong: edits are not isolated from the current branch.
- Ruling: Skip automated tests — developer instructions prohibit adding or running tests unless requested — cost if wrong: structural errors rely on visual and asset-integrity checks to catch them.
