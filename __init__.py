library(dplyr)
library(gamlss)

# ==========================================
# 1. PRZYSZŁE ZGŁOSZENIA IBNYR
# ==========================================

a <- end_year - start_year + 1

future <- expand.grid(
  i_index = 2:a,
  j = 1:a
) %>%
  filter(j >= a - i_index + 2) %>%
  mutate(
    i = start_year + i_index - 1,
    m = i + j - 1 - end_year
  )

# ==========================================
# 2. FREQUENCY - OCZEKIWANA LICZBA RENT
# ==========================================

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

# ==========================================
# 3. PODZIAŁ WEDŁUG TYPU RENTY
# ==========================================

future <- merge(
  future,
  as.data.frame(ann_type_split),
  by = NULL
)

future$N_r <- future$N_model * future$u

# ==========================================
# 4. SEVERITY - OCZEKIWANA KWOTA RENTY
# ==========================================

sev_mean <- sev %>%
  group_by(r, i) %>%
  summarise(
    Y_model = mean(Y_model),
    .groups = "drop"
  )

future <- future %>%
  left_join(sev_mean, by = c("r", "i"))

stopifnot(
  !anyNA(future$N_model),
  !anyNA(future$N_r),
  !anyNA(future$Y_model)
)

future$wartosc_roczna <- future$N_r * future$Y_model

# ==========================================
# 5. PRZYSZŁE WYPŁATY RENTOWE
# ==========================================

w <- as.data.frame(weights_data)
d <- as.data.frame(discount_factors)

# Zakładane znaczenie indeksów:
# m = okres zgłoszenia
# l = okres wypłaty

stopifnot(
  !anyDuplicated(w[, c("r", "i", "l", "m")]),
  !anyDuplicated(d$l)
)

# Kontrola pokrycia współczynnikami w
klucze <- unique(future[, c("r", "i", "m")])

brak_w <- anti_join(
  klucze,
  unique(w[, c("r", "i", "m")]),
  by = c("r", "i", "m")
)

if (nrow(brak_w) > 0) {
  stop("Brakuje współczynników w dla części przyszłych zgłoszeń.")
}

# Łączymy przyszłe roszczenia z harmonogramem wypłat
cashflows <- future %>%
  inner_join(
    w,
    by = c("r", "i", "m"),
    relationship = "many-to-many"
  ) %>%
  filter(l >= m)

# Kontrola liczby okresów wypłat
if (nrow(cashflows) == 0) {
  stop("Brak przepływów po połączeniu z wagami.")
}

# ==========================================
# 6. DYSKONTOWANIE
# ==========================================

cashflows <- cashflows %>%
  left_join(d, by = "l")

stopifnot(!anyNA(cashflows$d))

# Niedyskontowane przepływy
cashflows$CF_undisc <-
  cashflows$wartosc_roczna * cashflows$w

# Zdyskontowane przepływy
cashflows$CF_disc <-
  cashflows$CF_undisc * cashflows$d

# ==========================================
# 7. OSTATECZNE BEL MODELU
# ==========================================

BEL_model <- cashflows %>%
  group_by(i) %>%
  summarise(
    be_undisc_mod = sum(CF_undisc),
    be_disc_mod = sum(CF_disc),
    .groups = "drop"
  ) %>%
  arrange(i)

# SUMA BEL
BEL_total <- data.frame(
  be_undisc_mod = sum(BEL_model$be_undisc_mod),
  be_disc_mod = sum(BEL_model$be_disc_mod)
)

# ==========================================
# 8. WYNIKI
# ==========================================

print(as.data.frame(BEL_model), digits = 12)

print(BEL_total, digits = 12)
