library(gamlss)
library(dplyr)

# 1. Przyszłe komórki trójkąta
a <- end_year - start_year + 1

future <- expand.grid(
  i_index = 2:a,
  j = 1:a
) %>%
  filter(j >= a - i_index + 2) %>%
  mutate(i = start_year + i_index - 1)

# 2. Prognozowana liczba zgłoszeń Frequency
new_freq <- data.frame(
  i = future$i,
  j = future$j,
  N = NA_real_
)

future$N_model <- as.numeric(
  predict(
    model_freq,
    newdata = new_freq,
    data = as.data.frame(freq[, c("i", "j", "N")]),
    what = "mu",
    type = "response"
  )
)

# 3. Udziały typów rent
future <- merge(
  future,
  as.data.frame(ann_type_split),
  by = NULL
)

future$N_r <- future$N_model * future$u

# 4. Prognozowana średnia kwota Severity
sev_mean <- sev %>%
  group_by(r, i) %>%
  summarise(
    Y_model = mean(Y_model),
    .groups = "drop"
  )

future <- left_join(
  future,
  sev_mean,
  by = c("r", "i")
)

# 5. Oczekiwana roczna kwota nowych roszczeń
future$wartosc_roczna <- future$N_r * future$Y_model

# 6. Kontrola wyników
stopifnot(
  !anyNA(future$N_model),
  !anyNA(future$Y_model),
  !anyNA(future$u)
)

# 7. Wyniki według roku szkody
wyniki_modelu <- future %>%
  group_by(i) %>%
  summarise(
    liczba_rent = sum(N_r),
    wartosc_roczna = sum(wartosc_roczna),
    .groups = "drop"
  )

print(as.data.frame(wyniki_modelu), digits = 12)
