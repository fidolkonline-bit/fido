-- Grant Phase B permissions to the default roles (new keys only; nothing an admin removed is re-added).
UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['returns.create','stock.adjust','stock.transfer','expenses.view','expenses.manage']))
WHERE name IN ('Owner/Admin', 'Manager');
UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['stock.adjust','stock.transfer']))
WHERE name = 'Stock clerk';
