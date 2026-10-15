library(gamlss)

model_sev <- gamlss(
  Y ~ factor(r) + cs(i, df = 1),
  sigma.formula = ~ 1,
  family = LOGNO(mu.link = "identity",
                 sigma.link = "log"),
  data = sev,
  trace = FALSE
)

summary(model_sev)
options(digits = 12)

coef(model_sev, what = "mu")
coef(model_sev, what = "sigma")
