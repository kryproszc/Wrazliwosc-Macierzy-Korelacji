SELECT
  u.id AS user_id,
  u.login,
  u.imie,
  u.nazwisko,
  u.rola_id,
  MAX(s.expires_at) AS latest_expires_at,
  COUNT(*) AS active_sessions
FROM auth_sessions s
JOIN users u ON u.id = s.user_id
WHERE s.revoked_at IS NULL
  AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%S', 'now')
GROUP BY u.id, u.login, u.imie, u.nazwisko, u.rola_id
ORDER BY latest_expires_at DESC;
