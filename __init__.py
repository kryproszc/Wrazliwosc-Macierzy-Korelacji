library(dplyr)

cashflows_test <- future_claims %>%
  rename(m = l) %>%
  inner_join(
    weights_data,
    by = c("r", "i", "m"),
    relationship = "many-to-many"
  ) %>%
  mutate(
    payment = annual_amount * w
  )

BEL_test <- cashflows_test %>%
  group_by(i) %>%
  summarise(
    be_undisc_mod = sum(payment),
    .groups = "drop"
  )

print(as.data.frame(BEL_test), digits = 12)
