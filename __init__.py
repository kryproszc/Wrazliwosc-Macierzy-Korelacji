
library(dplyr)

# 1. Okresy zgłoszenia wynikające z prognozy Frequency
prognozy_2000 <- future_claims %>%
  filter(i == 2000) %>%
  distinct(i, j, N_model) %>%
  mutate(
    m_z_wzoru = i + j - 2025
  ) %>%
  arrange(j)

cat("\n=== PROGNOZY ROKU 2000 ===\n")
print(as.data.frame(prognozy_2000),
      row.names = FALSE, digits = 15)


# 2. Wszystkie okresy zgłoszenia dostępne w wagach
wagi_2000 <- weights_data %>%
  filter(i == 2000) %>%
  group_by(r, m) %>%
  summarise(
    min_l = min(l),
    max_l = max(l),
    liczba_wag = n(),
    suma_w = sum(w),
    .groups = "drop"
  ) %>%
  arrange(r, m)

cat("\n=== WAGI DLA ROKU 2000 ===\n")
print(as.data.frame(wagi_2000),
      row.names = FALSE, digits = 12)


# 3. Które okresy m mają prognozę Frequency?
kontrola_m <- wagi_2000 %>%
  left_join(
    prognozy_2000 %>%
      distinct(m_z_wzoru, N_model),
    by = c("m" = "m_z_wzoru")
  ) %>%
  mutate(
    ma_prognoze = !is.na(N_model)
  )

cat("\n=== KONTROLA OKRESÓW m ===\n")
print(as.data.frame(kontrola_m),
      row.names = FALSE, digits = 12)
