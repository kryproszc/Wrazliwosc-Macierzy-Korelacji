import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.stats import linregress, t as student_t
from scipy.optimize import curve_fit


# 1. LICZENIE WYBRANEGO TRENDU
def licz_trend(srednie, typ="linear"):
    y = np.asarray(srednie, dtype=float).reshape(-1)
    t = np.arange(1, len(y) + 1, dtype=float)

    if len(y) < 3 or not np.all(np.isfinite(y)):
        raise ValueError("Podaj co najmniej 3 skończone obserwacje.")

    if np.all(y == y[0]):
        raise ValueError("Szereg jest stały.")

    if typ == "linear":
        # Y_hat = a + b*t
        model = linregress(t, y)

        a = model.intercept
        b = model.slope
        trend = a + b * t
        p_value = model.pvalue

    elif typ == "exponential":
        # Y_hat = exp(a + b*t)
        if np.any(y <= 0):
            raise ValueError("Dla trendu wykładniczego podaj dodatnie średnie.")

        # Skalowanie poprawia stabilność obliczeń.
        skala = np.mean(y)
        z = y / skala

        # Regresja logarytmiczna tylko jako punkt startowy.
        start = linregress(t, np.log(z))

        def funkcja(x, a_scaled, b):
            return np.exp(a_scaled + b * x)

        parametry, kowariancja = curve_fit(
            funkcja,
            t,
            z,
            p0=[start.intercept, start.slope],
            maxfev=20000,
        )

        a_scaled, b = parametry
        a = a_scaled + np.log(skala)
        trend = skala * funkcja(t, a_scaled, b)

        # Przybliżony test H0: b = 0.
        se_b = np.sqrt(kowariancja[1, 1])

        if np.isfinite(se_b) and se_b > 0:
            statystyka = b / se_b
            p_value = 2 * student_t.sf(
                abs(statystyka), df=len(y) - 2
            )
        else:
            p_value = np.nan

    else:
        raise ValueError("Wybierz 'linear' albo 'exponential'.")

    sse = np.sum((y - trend) ** 2)
    sst = np.sum((y - np.mean(y)) ** 2)
    r2 = 1 - sse / sst

    return {
        "typ": typ,
        "t": t,
        "srednie": y,
        "trend": trend,
        "a": a,
        "b": b,
        "p_value": p_value,
        "R2": r2,
    }


# 2. WYKRES
def rysuj_trend(wynik, lata):
    lata = np.asarray(lata).reshape(-1)

    if len(lata) != len(wynik["srednie"]):
        raise ValueError("Liczba lat musi odpowiadać liczbie średnich.")

    fig, ax = plt.subplots(figsize=(10, 5))

    ax.plot(
        lata, wynik["srednie"],
        marker="o", color="steelblue",
        label="Średnia szkoda typowa",
    )

    nazwa = (
        "Trend liniowy"
        if wynik["typ"] == "linear"
        else "Trend wykładniczy"
    )

    ax.plot(
        lata, wynik["trend"],
        color="darkorange", label=nazwa,
    )

    ax.set_xlabel("Rok szkodowy")
    ax.set_ylabel("Średnia wartość szkody")
    ax.set_title("Średnia szkoda typowa i trend")
    ax.ticklabel_format(axis="y", style="plain")
    ax.grid(alpha=0.25)
    ax.legend()

    fig.tight_layout()
    plt.show()

    return fig, ax


# 3. TABELA DIAGNOSTYCZNA
def tabela_trendu(wynik):
    return pd.DataFrame({
        "typ": [wynik["typ"]],
        "a": [wynik["a"]],
        "b": [wynik["b"]],
        "p-value (H0: b = 0)": [wynik["p_value"]],
        "R2": [wynik["R2"]],
    })


# ============================================================
# WYBÓR TRENDU I WYWOŁANIE
# ============================================================

typ_trendu = "linear"       # albo "exponential"

wynik_trendu = licz_trend(
    srednie=ac_mean,
    typ=typ_trendu,
)

rysuj_trend(wynik_trendu, lata)

diagnostic = tabela_trendu(wynik_trendu)
display(diagnostic)
