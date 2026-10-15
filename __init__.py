library(dplyr)
library(gamlss)

valuation_year <- 2024

future_freq <- expand.grid(
  i = 2000:2024,
  j = 1:26
) %>%
  filter(i + j - 1 > valuation_year) %>%
  arrange(i, j) %>%
  as.data.frame()

# Techniczna kolumna wymagana przez predict.gamlss
future_freq$N <- 0

future_freq$N_model <- as.numeric(
  predict(
    model_freq,
    newdata = future_freq,
    data = as.data.frame(freq[, c("i", "j", "N")]),
    what = "mu",
    type = "response"
  )
)

# Numer przyszłego okresu zgłoszenia
future_freq$l <- with(
  future_freq,
  i + j - 1 - valuation_year
)

stopifnot(
  !anyNA(future_freq$N_model),
  all(is.finite(future_freq$N_model)),
  all(future_freq$N_model >= 0)
)

head(future_freq, 10)

sev_expected <- sev %>%
  group_by(r, i) %>%
  summarise(
    Y_expected = mean(Y_model),
    .groups = "drop"
  )

future_claims <- future_freq %>%
  select(i, j, l, N_model) %>%
  tidyr::crossing(r = unique(ann_type_split$r)) %>%
  left_join(
    as.data.frame(ann_type_split),
    by = "r"
  ) %>%
  left_join(
    sev_expected,
    by = c("r", "i")
  ) %>%
  mutate(
    N_r = N_model * u,
    annual_amount = N_r * Y_expected
  )

stopifnot(
  !anyNA(future_claims$annual_amount),
  all(is.finite(future_claims$annual_amount))
)

head(future_claims, 10)


weights_data %>%
  summarise(
    liczba_wierszy = n(),
    min_l = min(l),
    max_l = max(l),
    min_m = min(m),
    max_m = max(m),
    udzial_m_ge_l = mean(m >= l)
  )


cashflows <- future_claims %>%
  inner_join(
    as.data.frame(weights_data),
    by = c("r", "i", "l"),
    relationship = "many-to-many"
  ) %>%
  filter(m >= l) %>%
  left_join(
    as.data.frame(discount_factors) %>%
      rename(m = l, discount = d),
    by = "m"
  )

stopifnot(
  !anyNA(cashflows$discount),
  !anyNA(cashflows$w)
)

cashflows <- cashflows %>%
  mutate(
    payment_undisc = annual_amount * w,
    payment_disc = payment_undisc * discount
  )

BEL_model <- cashflows %>%
  group_by(i) %>%
  summarise(
    be_undisc_mod = sum(payment_undisc),
    be_disc_mod = sum(payment_disc),
    .groups = "drop"
  )

print(as.data.frame(BEL_model), digits = 12)

