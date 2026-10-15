
library(dplyr)

# Rok wyceny: 2024
# j = 1 oznacza rok zajścia szkody

fq_2000 <- future_claims %>%
  filter(i == 2000) %>%
  mutate(
    okres_zgloszenia = i + j - 2024 - 1
  ) %>%
  distinct(
    i, j, r, okres_zgloszenia,
    annual_amount
  )

print(as.data.frame(fq_2000), row.names = FALSE)

# Wagi zakładu: l = okres zgłoszenia, m = okres wypłaty
w_2000 <- weights_data %>%
  filter(i == 2000) %>%
  transmute(
    i, r,
    okres_zgloszenia = l,
    okres_wyplaty = m,
    w
  )

# Łączenie według pierwszego wzoru (10)
szczegoly_2000 <- fq_2000 %>%
  inner_join(
    w_2000,
    by = c("i", "r", "okres_zgloszenia")
  ) %>%
  filter(okres_wyplaty >= okres_zgloszenia) %>%
  mutate(
    skladnik_BE = annual_amount * w
  ) %>%
  arrange(r, okres_zgloszenia, okres_wyplaty)

# Kontrola szczegółowa
print(
  as.data.frame(head(szczegoly_2000, 10)),
  row.names = FALSE,
  digits = 15
)

# Wynik według rodzaju renty
wynik_2000 <- szczegoly_2000 %>%
  group_by(r) %>%
  summarise(
    liczba_wierszy = n(),
    suma_w = sum(w),
    BEL = sum(skladnik_BE),
    .groups = "drop"
  )

print(as.data.frame(wynik_2000),
      row.names = FALSE,
      digits = 15)

cat(
  "\nBEL 2000 =",
  sum(wynik_2000$BEL),
  "\n"
)

