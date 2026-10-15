library(dplyr)

porownanie_sev <- sev %>%
  group_by(r, i) %>%
  summarise(
    Y_data  = mean(Y),
    Y_model = mean(Y_model),
    .groups = "drop"
  )
