-- Apply owner-provided contact only once, preserving later headquarters edits.
UPDATE settings
SET document=json_set(document,'$.lineUrl','https://lin.ee/s4v3cIG')
WHERE id=1 AND COALESCE(json_extract(document,'$.lineUrl'),'')=''
AND NOT EXISTS(SELECT 1 FROM bootstrap_records WHERE key='official-line-v1');
INSERT OR IGNORE INTO bootstrap_records(key,applied_at)
VALUES('official-line-v1',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
