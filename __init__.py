options(digits = 12, width = 160)

cat("\n===== 1. FREQUENCY =====\n")
print(as.data.frame(
  future_claims %>%
    filter(i == 2000) %>%
    distinct(i, j, l, N_model)
), row.names = FALSE)

cat("\n===== 2. SEVERITY I UDZIALY =====\n")
print(as.data.frame(
  future_claims %>%
    filter(i == 2000) %>%
    select(r, u, Y_expected, N_r, annual_amount)
), row.names = FALSE)

cat("\n===== 3. SUMY WAG =====\n")
print(as.data.frame(
  weights_data %>%
    filter(i == 2000, m == 1) %>%
    group_by(r, m) %>%
    summarise(
      liczba = n(),
      suma_w = sum(w),
      .groups = "drop"
    )
), row.names = FALSE)

cat("\n===== 4. BE WEDLUG TYPU RENTY =====\n")
print(as.data.frame(
  cashflows_test %>%
    filter(i == 2000) %>%
    group_by(r) %>%
    summarise(
      BE = sum(payment),
      .groups = "drop"
    )
), row.names = FALSE)

cat("\n===== 5. BE LACZNIE =====\n")
print(as.data.frame(
  BEL_test %>% filter(i == 2000)
), row.names = FALSE)
