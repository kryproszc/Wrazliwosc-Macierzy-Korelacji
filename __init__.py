mu_sev <- fitted(model_sev, what = "mu")
sigma_sev <- fitted(model_sev, what = "sigma")

sev$Y_model <- exp(mu_sev + sigma_sev^2 / 2)

head(sev[, c("r", "i", "Y", "Y_model")], 10)
