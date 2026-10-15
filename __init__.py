library(dplyr)

cat("\n========== 1. FUTURE CLAIMS ==========\n")

print(
  future_claims %>%
    summarise(
      liczba = n(),
      min_i = min(i),
      max_i = max(i),
      min_j = min(j),
      max_j = max(j),
      min_l = min(l),
      max_l = max(l),
      brak_N = sum(is.na(N_model)),
      brak_Y = sum(is.na(Y_expected)),
      brak_amount = sum(is.na(annual_amount))
    )
)

cat("\n========== 2. ROK 2000 ==========\n")

print(
  future_claims %>%
    filter(i == 2000) %>%
    arrange(j, r) %>%
    select(i, j, l, r, N_model, u,
           Y_expected, N_r, annual_amount),
  n = Inf
)

cat("\n========== 3. KONTROLA INDEKSÓW ==========\n")

print(
  future_claims %>%
    mutate(
      l_oczekiwane = i + j - 2024,
      zgodne = l == l_oczekiwane
    ) %>%
    summarise(
      liczba_niezgodnych = sum(!zgodne, na.rm = TRUE),
      liczba_NA = sum(is.na(zgodne))
    )
)

cat("\n========== 4. KONTROLA UDZIAŁÓW ==========\n")

print(
  ann_type_split %>%
    summarise(
      suma_u = sum(u),
      min_u = min(u),
      max_u = max(u)
    )
)

cat("\n========== 5. KONTROLA KWOT ==========\n")

print(
  future_claims %>%
    mutate(
      kwota_kontrolna = N_model * u * Y_expected,
      roznica = annual_amount - kwota_kontrolna
    ) %>%
    summarise(
      max_roznica = max(abs(roznica), na.rm = TRUE),
      suma_kwot = sum(annual_amount)
    )
)

cat("\n========== 6. STRUKTURA WAG ==========\n")

print(
  weights_data %>%
    summarise(
      liczba = n(),
      min_l = min(l),
      max_l = max(l),
      min_m = min(m),
      max_m = max(m),
      liczba_NA = sum(is.na(w)),
      niepoprawne_l_m = sum(l < m)
    )
)

cat("\n========== 7. DUPLIKATY WAG ==========\n")

print(
  weights_data %>%
    count(r, i, l, m) %>%
    summarise(
      duplikaty = sum(n > 1),
      max_powtorzen = max(n)
    )
)

cat("\n========== 8. SUMY WAG ==========\n")

print(
  weights_data %>%
    filter(i == 2000) %>%
    group_by(r, m) %>%
    summarise(
      min_l = min(l),
      max_l = max(l),
      suma_w = sum(w),
      .groups = "drop"
    ) %>%
    arrange(r, m),
  n = 20
)

cat("\n========== 9. ŁĄCZENIE TABEL ==========\n")

test_join <- future_claims %>%
  inner_join(
    weights_data,
    by = c("r", "i", "l"),
    relationship = "many-to-many"
  )

print(
  test_join %>%
    summarise(
      liczba_polaczen = n(),
      min_m = min(m),
      max_m = max(m),
      udzial_m_ge_j = mean(m >= j),
      udzial_m_ge_1 = mean(m >= 1)
    )
)

cat("\n========== 10. ANALIZA WARUNKÓW ==========\n")

print(
  test_join %>%
    summarise(
      wiersze_wszystkie = n(),
      wiersze_m_ge_j = sum(m >= j),
      wiersze_m_ge_1 = sum(m >= 1),
      suma_w_wszystkie = sum(w),
      suma_w_m_ge_j = sum(w[m >= j]),
      suma_w_m_ge_1 = sum(w[m >= 1])
    )
)

cat("\n========== 11. KONTROLA DYSKONTA ==========\n")

print(
  discount_factors %>%
    summarise(
      liczba = n(),
      min_l = min(l),
      max_l = max(l),
      min_d = min(d),
      max_d = max(d),
      braki = sum(is.na(d))
    )
)
