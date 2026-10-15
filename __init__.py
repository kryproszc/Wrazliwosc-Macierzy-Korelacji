library(dplyr)

cashflows_corrected <- future_claims %>%
  inner_join(
    weights_data,
    by = c("r", "i", "l"),
    relationship = "many-to-many"
  ) %>%
  mutate(
    payment = annual_amount * w
  )

BEL_corrected <- cashflows_corrected %>%
  group_by(i) %>%
  summarise(
    be_undisc_mod = sum(payment),
    .groups = "drop"
  )

print(as.data.frame(BEL_corrected), digits = 12)
