wyniki_BE$BE_z_narzutami <-
  wyniki_BE$BE_model * 1.018 * 1.0963

print(
  wyniki_BE,
  row.names = FALSE,
  digits = 12
)
