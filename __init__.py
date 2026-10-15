# ==========================================
# KONTROLA PARAMETRÓW GAMLSS
# ==========================================

options(digits = 16)

# Frequency
freq_mu <- coef(model_freq, what = "mu")
freq_sigma <- coef(model_freq, what = "sigma")

# Severity
sev_mu <- coef(model_sev, what = "mu")
sev_sigma <- coef(model_sev, what = "sigma")

# Porównanie z Excelem
kontrola <- data.frame(
  Model = c(rep("FREQ", 4), rep("SEV", 4)),

  Parametr = c(
    "mu_intercept",
    "mu_i",
    "mu_j",
    "sigma_intercept",
    "mu_intercept",
    "mu_r2",
    "mu_i",
    "sigma_intercept"
  ),

  Excel = c(
    198.7452407,
    -0.096638495,
    -0.200322656,
    -2.778953213,
    -17.10050039,
    0.426104671,
    0.012875203,
    0.176668086
  ),

  R = c(
    unname(freq_mu),
    unname(freq_sigma),
    unname(sev_mu),
    unname(sev_sigma)
  )
)

kontrola$Roznica <- kontrola$R - kontrola$Excel

kontrola$Zgodnosc <- ifelse(
  abs(kontrola$Roznica) < 1e-8,
  "OK",
  "ROZNICA"
)

print(kontrola, row.names = FALSE, digits = 12)
