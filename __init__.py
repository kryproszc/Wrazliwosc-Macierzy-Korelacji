
library(gamlss)
library(ggplot2)
library(dplyr)

# ==========================================
# 1. FREQUENCY - WPLYW ROKU SZKODY
# ==========================================

freq_i <- data.frame(
  i = 1999:2024,
  j = rep(1, 26)
)

freq_i$pred <- as.numeric(
  predict(
    model_freq,
    newdata = freq_i,
    what = "mu",
    type = "response"
  )
)

freq_i$ratio <- freq_i$pred / freq_i$pred[1]

wykres_freq_i <- ggplot(freq_i, aes(i, ratio)) +
  geom_line(color = "blue", linewidth = 1) +
  labs(
    title = "Zależność liczby zgłaszanych rent od roku szkody",
    x = "i",
    y = "Stosunek predykcji"
  ) +
  theme_bw()

print(wykres_freq_i)


# ==========================================
# 2. FREQUENCY - WPLYW OKRESU ROZWOJU
# ==========================================

freq_j <- data.frame(
  i = rep(1999, 26),
  j = 1:26
)

freq_j$pred <- as.numeric(
  predict(
    model_freq,
    newdata = freq_j,
    what = "mu",
    type = "response"
  )
)

freq_j$ratio <- freq_j$pred / freq_j$pred[1]

wykres_freq_j <- ggplot(freq_j, aes(j, ratio)) +
  geom_line(color = "blue", linewidth = 1) +
  labs(
    title = "Zależność liczby zgłaszanych rent od roku rozwoju",
    x = "j",
    y = "Stosunek predykcji"
  ) +
  theme_bw()

print(wykres_freq_j)


# ==========================================
# 3. SEVERITY - WPLYW ROKU SZKODY
# ==========================================

sev_i <- data.frame(
  i = 1999:2024,
  r = factor(
    rep(1, 26),
    levels = levels(factor(sev$r))
  )
)

sev_i$mu <- as.numeric(
  predict(
    model_sev,
    newdata = sev_i,
    what = "mu",
    type = "response"
  )
)

# Sigma jest stala w naszym modelu
sigma_sev <- exp(
  as.numeric(coef(model_sev, what = "sigma")[1])
)

sev_i$pred <- exp(
  sev_i$mu + sigma_sev^2 / 2
)

sev_i$ratio <- sev_i$pred / sev_i$pred[1]

wykres_sev_i <- ggplot(sev_i, aes(i, ratio)) +
  geom_line(color = "blue", linewidth = 1) +
  labs(
    title = "Zależność wysokości roszczenia rentowego od roku szkody",
    x = "i",
    y = "Stosunek predykcji"
  ) +
  theme_bw()

print(wykres_sev_i)
