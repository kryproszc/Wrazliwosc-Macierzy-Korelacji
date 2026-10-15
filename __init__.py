
library(dplyr)

# 1. Dane frequency i severity dla roku 2000
fq_2000 <- future_claims %>%
  filter(i == 2000) %>%
  distinct(i, j, r, annual_amount) %>%
  mutate(
    okres_zgloszenia = i + j - 2024 - 1
  )

# 2. Wagi z oryginalnego arkusza w
w_2000 <- weights_data %>%
  filter(i == 2000) %>%
  transmute(
    i = i,
    r = r,
    okres_zgloszenia = m,
    okres_wyplaty = l,
    w = w
  )

# 3. Łączenie
szczegoly_2000 <- fq_2000 %>%
  inner_join(
    w_2000,
    by = c("i", "r", "okres_zgloszenia")
  ) %>%
  filter(okres_wyplaty >= okres_zgloszenia) %>%
  mutate(
    skladnik_BE = annual_amount * w
  ) %>%
  arrange(r, okres_wyplaty)

# 4. Wyniki dla każdego typu renty
wynik_2000 <- szczegoly_2000 %>%
  group_by(r) %>%
  summarise(
    liczba_wierszy = n(),
    min_l = min(okres_wyplaty),
    max_l = max(okres_wyplaty),
    suma_w = sum(w),
    BEL = sum(skladnik_BE),
    .groups = "drop"
  )

print(
  as.data.frame(wynik_2000),
  row.names = FALSE,
  digits = 15
)

cat(
  "\nBEL 2000 =",
  sum(wynik_2000$BEL),
  "\n"
)
