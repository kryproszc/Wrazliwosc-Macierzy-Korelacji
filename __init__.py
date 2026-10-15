model_freq <- gamlss(
  N ~ cs(i, df = 1) + cs(j, df = 11),
  sigma.formula = ~ 1,
  family = NBI(mu.link = "log", sigma.link = "log"),
  data = freq,
  trace = FALSE
)

summary(model_freq)
