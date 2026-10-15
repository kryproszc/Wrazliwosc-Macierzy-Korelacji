
library(ggplot2)

# 1. Dane do predykcji
freq_j <- data.frame(
  i = rep(1999, 26),
  j = 1:26
)

# 2. Predykcja oczekiwanej liczby rent
freq_j$N_model <- as.numeric(
  predict(
    model_freq,
    newdata = freq_j,
    what = "mu",
    type = "response"
  )
)

# 3. Stosunek predykcji względem j = 1
freq_j$stosunek <- freq_j$N_model / freq_j$N_model[1]

# 4. Wykres jak w Excelu
wykres <- ggplot(freq_j, aes(x = j, y = stosunek)) +
  geom_line(color = "blue", linewidth = 1) +
  labs(
    title = "Zależność liczby zgłaszanych rent od roku rozwoju",
    x = "j",
    y = "Stosunek predykcji"
  ) +
  scale_x_continuous(breaks = seq(0, 26, 5)) +
  theme_bw()

print(wykres)

# 5. Dane liczbowe do porównania z Excelem
print(freq_j, row.names = FALSE, digits = 12)
