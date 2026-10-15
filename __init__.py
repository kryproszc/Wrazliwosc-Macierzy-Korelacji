
library(dplyr)

# 1. Dane modelu dla roku 2000
N_2000 <- 2.12024156745

# 2. Severity według typu renty
severity_2000 <- sev %>%
  filter(i == 2000) %>%
  group_by(r) %>%
  summarise(
    Y_expected = first(Y_model),
    .groups = "drop"
  )

# 3. Rozpisanie wszystkich składników wzoru (10)
BE_skladniki_2000 <- weights_data %>%
  filter(i == 2000, m == 1) %>%
  left_join(
    ann_type_split,
    by = "r"
  ) %>%
  left_join(
    severity_2000,
    by = "r"
  ) %>%
  mutate(
    j = 26,
    N_model = N_2000,
    N_r = N_model * u,
    annual_amount = N_r * Y_expected,
    skladnik_BE = annual_amount * w
  ) %>%
  select(
    i, j, r, l, m,
    N_model, u, N_r,
    Y_expected, annual_amount,
    w, skladnik_BE
  ) %>%
  arrange(r, l)

# 4. Wyświetlenie wszystkich 200 składników
print(
  as.data.frame(BE_skladniki_2000),
  row.names = FALSE,
  digits = 12
)

# 5. Kontrola sumowania
BE_skladniki_2000 %>%
  group_by(r) %>%
  summarise(
    liczba_wierszy = n(),
    suma_w = sum(w),
    BE = sum(skladnik_BE),
    .groups = "drop"
  ) %>%
  print()

# 6. Łączne BE
sum(BE_skladniki_2000$skladnik_BE)
