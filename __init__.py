dane <- sev_ind_data[
  as.character(sev_ind_data$LOB) %in% c("4", "LOB_4") &
  sev_ind_data$i %in% 2022:2024,
]

# Liczby obserwacji według roku i typu renty
table(dane$i, dane$r)

# Liczba rent każdego typu
n1 <- sum(dane$r == 1, na.rm = TRUE)
n2 <- sum(dane$r == 2, na.rm = TRUE)

n1
n2
n1 + n2

# Udziały — zwykłe dzielenie
n1 / (n1 + n2)
n2 / (n1 + n2)
