from pathlib import Path

import numpy as np
import pandas as pd


def wczytaj_dane(folder, plik, wybor, hrg=None):

    sciezka = Path(folder) / plik
    dane = {}

    with pd.ExcelFile(sciezka, engine="openpyxl") as excel:
        for nazwa, (arkusz, kolumna) in wybor.items():
            df = pd.read_excel(excel, sheet_name=arkusz)
            df.columns = df.columns.map(lambda x: str(x).strip())

            # Arkusze zawierające dane dla wielu linii.
            if hrg is not None and "HRG" in df.columns:
                df = df.loc[
                    df["HRG"].astype(str).str.strip() == hrg
                ].copy()

            if df.empty:
                raise ValueError(f"{arkusz}: brak danych dla wybranego HRG.")

            if kolumna not in df.columns:
                raise ValueError(
                    f"{arkusz}: brak kolumny {kolumna!r}. "
                    f"Dostępne: {list(df.columns)}"
                )

            kolumna_roku = next(
                (k for k in ["YEAR", "EVENT_YEAR"] if k in df.columns),
                None
            )

            if kolumna_roku is None:
                raise ValueError(f"{arkusz}: brak YEAR lub EVENT_YEAR.")

            df = df.loc[df[kolumna_roku].notna()].copy()

            rok = pd.to_numeric(df[kolumna_roku], errors="raise").to_numpy(
                dtype=int
            )
            wartosc = pd.to_numeric(df[kolumna], errors="raise").to_numpy(
                dtype=float, na_value=np.nan
            )

            if len(np.unique(rok)) != len(rok):
                raise ValueError(
                    f"{arkusz}: więcej niż jeden wiersz dla tego samego roku."
                )

            kolejnosc = np.argsort(rok)

            dane[nazwa] = {
                "rok": rok[kolejnosc],
                "wartosc": wartosc[kolejnosc],
            }

    return dane


def wczytaj_trojkat(folder, plik, arkusz="Nb_triangle"):
    """
    Pierwsza kolumna: rok szkody.
    Pozostałe kolumny: okresy rozwoju, np. 12, 24, 36...

    Zachowuje część obserwowaną wraz z przekątną:
        x x x x
        x x x nan
        x x nan nan
        x nan nan nan
    """
    sciezka = Path(folder) / plik

    df = pd.read_excel(
        sciezka,
        sheet_name=arkusz,
        index_col=0,
        engine="openpyxl",
    )

    # Pomijamy kolumny dodatkowe, np. ultimate lub współczynniki.
    okresy = pd.to_numeric(df.columns, errors="coerce")
    kolumny_rozwoju = np.isfinite(okresy)
    df = df.loc[df.index.notna(), kolumny_rozwoju]

    indeks = df.index
    if pd.api.types.is_numeric_dtype(indeks.dtype):
        lata = indeks.to_numpy(dtype=int)
    else:
        lata = pd.to_datetime(indeks, errors="raise").year.to_numpy()

    okresy = np.asarray(okresy[kolumny_rozwoju], dtype=float)
    trojkat = df.apply(pd.to_numeric, errors="raise").to_numpy(
        dtype=float, na_value=np.nan
    )

    # Najstarszy rok na górze, okresy rozwoju rosnąco.
    kolejnosc_lat = np.argsort(lata)
    kolejnosc_okresow = np.argsort(okresy)

    lata = lata[kolejnosc_lat]
    okresy = okresy[kolejnosc_okresow]
    trojkat = trojkat[np.ix_(kolejnosc_lat, kolejnosc_okresow)]

    n, m = trojkat.shape
    if n != m:
        raise ValueError(
            f"Trójkąt ma rozmiar {n} × {m}. "
            "Przed maskowaniem trzeba ustalić zakres lat i okresów rozwoju."
        )

    if len(np.unique(lata)) != n or len(np.unique(okresy)) != m:
        raise ValueError("Powtarzające się lata lub okresy rozwoju.")

    i, j = np.indices((n, m))
    maska_obserwacji = i + j <= n - 1

    trojkat = np.where(maska_obserwacji, trojkat, np.nan)

    return lata, okresy, trojkat



folder = r"C:\Users\Mateusz\Documents\Model"
plik = "4M_MTPL-run14.xlsx"

wybor = {
    # nazwa własna: (nazwa arkusza, nazwa kolumny)
    "inflacja": ("inflation", "VALUE"),
    "ekspozycja": ("exposure", "EARNED_RISK"),
    "szkody": ("Claims_Value", "Am_Ult"),
}

dane = wczytaj_dane(
    folder=folder,
    plik=plik,
    wybor=wybor,
    hrg="4M_MTPL",
)

lata_nb, okresy_nb, nb_triangle = wczytaj_trojkat(
    folder, plik, arkusz="Nb_triangle"
)
