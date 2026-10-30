import numpy as np
import pandas as pd
import matplotlib.pyplot as plt


def usun_trend_liniowy(srednie, lata, b, rok_docelowy=2025):
    srednie = np.asarray(srednie, dtype=float)
    lata = np.asarray(lata)

    if srednie.ndim != 1 or srednie.shape != lata.shape:
        raise ValueError("Średnie i lata muszą być wektorami tej samej długości.")

    korekta = b * (rok_docelowy - lata)

    return pd.DataFrame({
        "EVENT_YEAR": lata,
        "X_AC_mean": srednie + korekta,
        "AC_Ave_pierwotne": srednie,
        "Korekta": korekta,
    })


def rysuj_srednie_po_korekcie(tabela, rok_docelowy=2025):
    fig, ax = plt.subplots(figsize=(11, 5))

    ax.plot(
        tabela["EVENT_YEAR"],
        tabela["X_AC_mean"],
        color="steelblue",
        marker="o",
    )

    ax.set_title(
        f"X_AC_mean_detrended — poziom roku {rok_docelowy}"
    )
    ax.set_xlabel("Rok szkodowy")
    ax.set_ylabel("Średnia wysokość szkody")
    ax.set_xticks(tabela["EVENT_YEAR"])
    ax.tick_params(axis="x", rotation=45)
    ax.set_ylim(bottom=0)
    ax.grid(alpha=0.25)

    fig.tight_layout()
    plt.show()


# Korzystamy z wcześniej obliczonego trendu.
# Podajemy średnie PIERWOTNE, przed korektą.
rok_docelowy = 2025

tabela_detrended = usun_trend_liniowy(
    srednie=wynik_trendu["srednie"],
    lata=np.arange(2007, 2025),
    b=wynik_trendu["b"],
    rok_docelowy=rok_docelowy,
)

display(tabela_detrended)

rysuj_srednie_po_korekcie(
    tabela_detrended,
    rok_docelowy=rok_docelowy,
)
