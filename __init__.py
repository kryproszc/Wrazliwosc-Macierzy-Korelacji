library(gamlss)

model_poisson <- gamlss(
  N ~ i + j,
  family = PO(),
  data = freq,
  trace = FALSE
)

summary(model_poisson)
