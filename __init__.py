library(dplyr)

options(digits = 15, width = 200)

# 1. FREQUENCY - rok 2000
cat("\n========== FREQUENCY ==========\n")

print(as.data.frame(
  freq %>%
    filter(i == 2000, j >= 26) %>%
    select(i, j, N_model)
), row.names = FALSE)


# 2. SEVERITY - rok 2000
cat("\n========== SEVERITY ==========\n")

print(as.data.frame(
  sev %>%
    filter(i == 2000) %>%
    select(r, i, Y_model)
), row.names = FALSE)


# 3. UDZIAŁY RENT
cat("\n========== UDZIAŁY ==========\n")

print(as.data.frame(u_data), row.names = FALSE)


# 4. WAGI - struktura dla 2000 roku
cat("\n========== WAGI ==========\n")

print(as.data.frame(
  w_data %>%
    filter(i == 2000) %>%
    group_by(r, m) %>%
    summarise(
      min_l = min(l),
      max_l = max(l),
      liczba = n(),
      suma_w = sum(w),
      suma_w_od_m = sum(w[l >= m]),
      .groups = "drop"
    )
), row.names = FALSE)


# 5. BE WEDŁUG TYPU RENTY
cat("\n========== BE WEDŁUG TYPU ==========\n")

print(as.data.frame(
  wyliczenie_BEL_2000 %>%
    group_by(r, m) %>%
    summarise(
      liczba = n(),
      N_model = first(N_model),
      u = first(u),
      N_r = first(N_r),
      Y_model = first(Y_model),
      annual_amount = first(annual_amount),
      suma_w = sum(w),
      BE = sum(payment),
      .groups = "drop"
    )
), row.names = FALSE)


# 6. BE ŁĄCZNIE
cat("\n========== BE ŁĄCZNIE ==========\n")

print(sum(wyliczenie_BEL_2000$payment),
      digits = 15)
