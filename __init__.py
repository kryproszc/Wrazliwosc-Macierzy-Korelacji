testy_symulacji = pd.DataFrame({
    "Normal": testy_KS_AD(obs_normal, normal),
    "Gamma": testy_KS_AD(obs_gamma, gamma),
    "LogNormal": testy_KS_AD(obs_lognormal, lognormal),
}).T

display(testy_symulacji)
