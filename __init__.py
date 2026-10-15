library(dplyr)

wyniki_sev <- sev %>%
  group_by(r, i) %>%
  summarise(
    Y_model = mean(Y_model),
    .groups = "drop"
  )

print(as.data.frame(wyniki_sev), digits = 12)




sev %>%
  group_by(r, i) %>%
  summarise(
    rozstep = max(Y_model) - min(Y_model),
    .groups = "drop"
  ) %>%
  summarise(max_rozstep = max(rozstep))
