SELECT
  u.login,
  u.rola_id,
  s.expires_at,
  s.revoked_at
FROM auth_sessions s
JOIN users u ON u.id = s.user_id
WHERE s.revoked_at IS NULL
ORDER BY s.expires_at DESC;
