def tabela_estimated_params_sev_bez_trendu(srednie):
    y = np.asarray(srednie, dtype=float)
    n = len(y)

    mu_hat = np.mean(y)
    sigma_sq_hat = np.sum((y - mu_hat) ** 2) / (n - 1)

    return pd.DataFrame({
        "mu_hat": [mu_hat],
        "sigma_sq_hat": [sigma_sq_hat],
        "phi_hat_0": [np.nan],
        "phi_hat_2": [np.nan],
    })


estimated_params_sev_bez_trendu = tabela_estimated_params_sev_bez_trendu(
    wynik_trendu["srednie"]
)

display(
    estimated_params_sev_bez_trendu.style.format(
        "{:.12f}",
        na_rep="",
    )
)
