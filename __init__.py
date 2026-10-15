
library(dplyr)

# Jeden wiersz na kombinację roku, okresu zgłoszenia i typu renty
fc_2000 <- future_claims %>%
  filter(i == 2000) %>%
  distinct(i, j, m, r, annual_amount)

# Łączenie z wszystkimi przyszłymi wypłatami
kontrola_2000 <- fc_2000 %>%
  inner_join(
    weights_data %>% filter(i == 2000),
    by = c("i", "r", "m" = "l")
  ) %>%
  mutate(
    skladnik_BE = if_else(
      m.y >= m.x,
      annual_amount * w,
      0
    )
  )





library(dplyr)

fc_2000 <- future_claims %>%
  filter(i == 2000) %>%
  distinct(i, j, m, r, annual_amount) %>%
  rename(okres_zgloszenia = m)

w_2000 <- weights_data %>%
  filter(i == 2000) %>%
  transmute(
    i, r,
    okres_zgloszenia = l,
    okres_wyplaty = m,
    w
  )

kontrola_2000 <- fc_2000 %>%
  inner_join(
    w_2000,
    by = c("i", "r", "okres_zgloszenia")
  ) %>%
  mutate(
    skladnik_BE = if_else(
      okres_wyplaty >= okres_zgloszenia,
      annual_amount * w,
      0
    )
  )

wynik <- kontrola_2000 %>%
  group_by(r) %>%
  summarise(
    liczba_wierszy = n(),
    min_wyplata = min(okres_wyplaty),
    max_wyplata = max(okres_wyplaty),
    suma_w = sum(w[okres_wyplaty >= okres_zgloszenia]),
    BEL = sum(skladnik_BE),
    .groups = "drop"
  )

print(as.data.frame(wynik),
      row.names = FALSE,
      digits = 15)

cat("\nBEL 2000:", sum(wynik$BEL), "\n")
