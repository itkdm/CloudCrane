-- Backfill billing ownership for websites created before billing provisioning
-- was enabled. This gives legacy free-preview websites the same 50 MiB
-- attachment quota as newly provisioned websites.
DO $$
DECLARE
  free_plan_id uuid;
  free_version_id uuid;
  preview_definition_id uuid;
  production_definition_id uuid;
  website_count_definition_id uuid;
  storage_definition_id uuid;
  owner_row record;
  account_id uuid;
  subscription_id uuid;
  now_at timestamptz := now();
BEGIN
  INSERT INTO plan (key, name, description, status)
  VALUES ('free-preview', 'Free Preview', '基础预览权益，不包含正式网站发布能力。', 'active')
  ON CONFLICT (key) DO UPDATE SET status = 'active'
  RETURNING id INTO free_plan_id;

  IF free_plan_id IS NULL THEN
    SELECT id INTO free_plan_id FROM plan WHERE key = 'free-preview';
  END IF;

  INSERT INTO plan_version (
    plan_id, version, display_name, description, status, billing_interval,
    interval_count, price_amount, price_currency, published_at
  )
  VALUES (
    free_plan_id, 1, 'Free Preview', '基础预览权益，不包含正式网站发布能力。',
    'published', 'one_time', 1, 0, 'USD', now_at
  )
  ON CONFLICT (plan_id, version) DO UPDATE SET status = 'published'
  RETURNING id INTO free_version_id;

  IF free_version_id IS NULL THEN
    SELECT id INTO free_version_id
    FROM plan_version
    WHERE plan_id = free_plan_id AND version = 1;
  END IF;

  INSERT INTO entitlement_definition (key, name, value_type)
  VALUES ('preview.enabled', 'Preview', 'boolean')
  ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO preview_definition_id;
  IF preview_definition_id IS NULL THEN
    SELECT id INTO preview_definition_id FROM entitlement_definition WHERE key = 'preview.enabled';
  END IF;

  INSERT INTO entitlement_definition (key, name, value_type)
  VALUES ('production.enabled', 'Production website', 'boolean')
  ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO production_definition_id;
  IF production_definition_id IS NULL THEN
    SELECT id INTO production_definition_id FROM entitlement_definition WHERE key = 'production.enabled';
  END IF;

  INSERT INTO entitlement_definition (key, name, value_type, unit)
  VALUES ('production.website_count', 'Production website count', 'metered', 'websites')
  ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, unit = EXCLUDED.unit
  RETURNING id INTO website_count_definition_id;
  IF website_count_definition_id IS NULL THEN
    SELECT id INTO website_count_definition_id FROM entitlement_definition WHERE key = 'production.website_count';
  END IF;

  INSERT INTO entitlement_definition (key, name, value_type, unit)
  VALUES ('storage.account_bytes', 'Account attachment storage', 'metered', 'bytes')
  ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, unit = EXCLUDED.unit
  RETURNING id INTO storage_definition_id;
  IF storage_definition_id IS NULL THEN
    SELECT id INTO storage_definition_id FROM entitlement_definition WHERE key = 'storage.account_bytes';
  END IF;

  INSERT INTO plan_entitlement (plan_version_id, entitlement_definition_id, enabled, value)
  VALUES
    (free_version_id, preview_definition_id, true, '{"enabled":true}'::jsonb),
    (free_version_id, production_definition_id, true, '{"enabled":false}'::jsonb),
    (free_version_id, website_count_definition_id, true, '{"limit":0,"unit":"websites","limitMode":"hard"}'::jsonb),
    (free_version_id, storage_definition_id, true, '{"limit":52428800,"unit":"bytes","limitMode":"hard"}'::jsonb)
  ON CONFLICT (plan_version_id, entitlement_definition_id) DO NOTHING;

  FOR owner_row IN
    SELECT DISTINCT owner_id
    FROM website
    WHERE billing_account_id IS NULL AND owner_id IS NOT NULL
  LOOP
    SELECT id INTO account_id
    FROM billing_account
    WHERE personal_owner_user_id = owner_row.owner_id
      AND kind = 'personal'
      AND status = 'active'
    LIMIT 1;

    IF account_id IS NULL THEN
      INSERT INTO billing_account (kind, personal_owner_user_id, name, status)
      VALUES ('personal', owner_row.owner_id, 'CloudCrane personal account', 'active')
      RETURNING id INTO account_id;
    END IF;

    INSERT INTO billing_account_member (billing_account_id, user_id, role, status)
    VALUES (account_id, owner_row.owner_id, 'owner', 'active')
    ON CONFLICT (billing_account_id, user_id) DO NOTHING;

    UPDATE website
    SET billing_account_id = account_id, updated_at = now_at
    WHERE owner_id = owner_row.owner_id AND billing_account_id IS NULL;

    SELECT id INTO subscription_id
    FROM subscription
    WHERE billing_account_id = account_id
      AND status IN ('trialing', 'active', 'grace', 'canceling')
    LIMIT 1;

    IF subscription_id IS NULL THEN
      INSERT INTO subscription (billing_account_id, plan_version_id, status, starts_at)
      VALUES (account_id, free_version_id, 'active', now_at)
      RETURNING id INTO subscription_id;
    END IF;

    INSERT INTO entitlement_grant (
      billing_account_id, entitlement_definition_id, scope, source_type,
      source_ref, value, status, starts_at
    )
    SELECT account_id, preview_definition_id, 'account', 'subscription',
      'free-preview:v1', '{"enabled":true}'::jsonb, 'active', now_at
    WHERE NOT EXISTS (
      SELECT 1 FROM entitlement_grant
      WHERE billing_account_id = account_id
        AND entitlement_definition_id = preview_definition_id
        AND source_ref = 'free-preview:v1' AND status = 'active'
    );

    INSERT INTO entitlement_grant (
      billing_account_id, entitlement_definition_id, scope, source_type,
      source_ref, value, status, starts_at
    )
    SELECT account_id, production_definition_id, 'account', 'subscription',
      'free-preview:v1', '{"enabled":false}'::jsonb, 'active', now_at
    WHERE NOT EXISTS (
      SELECT 1 FROM entitlement_grant
      WHERE billing_account_id = account_id
        AND entitlement_definition_id = production_definition_id
        AND source_ref = 'free-preview:v1' AND status = 'active'
    );

    INSERT INTO entitlement_grant (
      billing_account_id, entitlement_definition_id, scope, source_type,
      source_ref, value, status, starts_at
    )
    SELECT account_id, website_count_definition_id, 'account', 'subscription',
      'free-preview:v1', '{"limit":0,"unit":"websites","limitMode":"hard"}'::jsonb, 'active', now_at
    WHERE NOT EXISTS (
      SELECT 1 FROM entitlement_grant
      WHERE billing_account_id = account_id
        AND entitlement_definition_id = website_count_definition_id
        AND source_ref = 'free-preview:v1' AND status = 'active'
    );

    INSERT INTO entitlement_grant (
      billing_account_id, entitlement_definition_id, scope, source_type,
      source_ref, value, status, starts_at
    )
    SELECT account_id, storage_definition_id, 'account', 'subscription',
      'free-preview:v1', '{"limit":52428800,"unit":"bytes","limitMode":"hard"}'::jsonb, 'active', now_at
    WHERE NOT EXISTS (
      SELECT 1 FROM entitlement_grant
      WHERE billing_account_id = account_id
        AND entitlement_definition_id = storage_definition_id
        AND source_ref = 'free-preview:v1' AND status = 'active'
    );
  END LOOP;
END $$;
