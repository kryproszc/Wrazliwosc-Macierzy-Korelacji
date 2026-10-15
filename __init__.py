
library(dplyr)

# Dane dla roku szkody 2000
fc_2000 <- future_claims %>%
  filter(i == 2000) %>%
  distinct(i, j, l, r, annual_amount)

# Kontrola indeksu zgłoszenia
print(fc_2000)

# Łączenie zgodne z arkuszem wag zakładu:
# l = okres zgłoszenia
# m = okres wypłaty

kontrola_2000 <- fc_2000 %>%
  inner_join(
    weights_data %>% filter(i == 2000),
    by = c("i", "r", "l")
  ) %>%
  mutate(
    warunek = m >= l,
    skladnik_BE = if_else(
      warunek,
      annual_amount * w,
      0
    )
  )

# Podsumowanie według rodzaju renty
wynik <- kontrola_2000 %>%
  group_by(r) %>%
  summarise(
    okres_zgloszenia = first(l),
    min_m = min(m),
    max_m = max(m),
    suma_w = sum(w[warunek]),
    BEL = sum(skladnik_BE),
    .groups = "drop"
  )

print(as.data.frame(wynik),
      row.names = FALSE,
      digits = 15)

cat(
  "\nBEL 2000:",
  sum(wynik$BEL),
  "\n"
)
