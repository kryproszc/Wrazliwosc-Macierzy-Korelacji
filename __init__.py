import numpy as np
import pandas as pd
from scipy.optimize import curve_fit


def estimated_params_czestosci(
    liczba_ultimate,
    ekspozycja,
    lata,
    trend="bez",
    rok_modelowy=2025,
):
    liczba = np.asarray(liczba_ultimate, dtype=float)
    expo = np.asarray(ekspozycja, dtype=float)
    lata = np.asarray(lata, dtype=float)

    freq = liczba / expo
    n = len(freq)
    t = lata - lata[0] + 1
    t_modelowy = rok_modelowy - lata[0] + 1

    if trend == "bez":
        mu_hat = np.sum(expo * freq) / np.sum(expo)
        mu_t = np.full(n, mu_hat)
        reszty = freq - mu_t
        skladniki_sigma = expo * reszty ** 2
        sigma_sq_hat = np.sum(skladniki_sigma) / (n - 1)
        phi_hat = sigma_sq_hat / mu_hat
        skladniki_phi = skladniki_sigma / mu_hat
        mianownik = n - 1

    else:
        if trend == "linear":
            macierz = np.column_stack([np.ones(n), t])
            a, b = np.linalg.lstsq(
                macierz * np.sqrt(expo)[:, None],
                freq * np.sqrt(expo),
                rcond=None,
            )[0]

            mu_t = a + b * t
            mu_hat = a + b * t_modelowy

        elif trend == "exponential":
            skala = np.average(freq, weights=expo)

            def krzywa(t, alpha, beta):
                return np.exp(alpha + beta * t)

            alpha, b = curve_fit(
                krzywa,
                t,
                freq / skala,
                p0=(0.0, 0.0),
                sigma=1 / np.sqrt(expo),
                maxfev=100000,
            )[0]

            a = alpha + np.log(skala)
            mu_t = np.exp(a + b * t)
            mu_hat = np.exp(a + b * t_modelowy)

        reszty = freq - mu_t
        skladniki_sigma = expo * reszty ** 2
        skladniki_phi = skladniki_sigma / mu_t
        phi_hat = np.sum(skladniki_phi) / (n - 2)
        sigma_sq_hat = np.nan
        mianownik = n - 2

    parametry = pd.DataFrame({
        "mu_hat": [mu_hat],
        "sigma_sq_hat": [sigma_sq_hat],
        "phi_hat": [phi_hat],
    })

    obliczenia = pd.DataFrame({
        "YEAR": lata.astype(int),
        "t": t,
        "Nb_Ult": liczba,
        "Expo": expo,
        "Freq": freq,
        "Expo_razy_Freq": expo * freq,
        "mu_t": mu_t,
        "Reszta": reszty,
        "Reszta_kwadrat": reszty ** 2,
        "Expo_razy_reszta_kwadrat": skladniki_sigma,
        "Skladnik_phi": skladniki_phi,
        "Wklad_do_phi_hat": skladniki_phi / mianownik,
    })

    return parametry, obliczenia

estimated_params_AC, obliczenia_czestosci_AC = estimated_params_czestosci(
    liczba_ultimate=AC_Nb_Ult,
    ekspozycja=expo,
    lata=np.arange(2007, 2025),
    trend="bez",
    rok_modelowy=2025,
)

display(estimated_params_AC.style.format("{:.12f}", na_rep=""))
display(obliczenia_czestosci_AC.style.format("{:.12g}"))
