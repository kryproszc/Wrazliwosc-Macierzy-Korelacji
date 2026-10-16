
import pandas as pd
import numpy as np

def wczytaj_trojkat(plik, arkusz, hrg, cumulative=True):

    df = pd.read_excel(plik, sheet_name=arkusz)

    df = df[
        df["HRG"].astype(str).str.strip() == str(hrg).strip()
    ].copy()

    if df.empty:
        raise ValueError(f"Brak danych dla HRG = {hrg}")

    for col in ["VENT_YEAR", "DEV_YEAR", "AMOUNT"]:
        df[col] = pd.to_numeric(
            df[col].astype(str).str.replace(",", ".", regex=False),
            errors="coerce"
        )

    df = df.dropna(subset=["VENT_YEAR", "DEV_YEAR"])

    trojkat = df.pivot_table(
        index="VENT_YEAR",
        columns="DEV_YEAR",
        values="AMOUNT",
        aggfunc="sum"
    )

    trojkat = trojkat.sort_index().sort_index(axis=1)

    # Zakładamy, że ostatni rok kalendarzowy to
    # maksymalny VENT_YEAR + DEV_YEAR w danych.
    ostatni_rok = int(
        (df["VENT_YEAR"] + df["DEV_YEAR"]).max()
    )

    lata = trojkat.index.to_numpy(dtype=int)
    rozwoj = trojkat.columns.to_numpy(dtype=int)

    # Maska obserwowanej części trójkąta
    maska = (
        lata[:, None] + rozwoj[None, :]
        <= ostatni_rok
    )

    # Puste komórki tylko w części obserwowanej -> 0
    trojkat = trojkat.where(maska).fillna(0).where(maska)

    # Kumulacja wyłącznie wartości obserwowanych
    if cumulative:
        trojkat = trojkat.fillna(0).cumsum(axis=1).where(maska)

    lista = [
        row.dropna().tolist()
        for _, row in trojkat.iterrows()
    ]

    return lista, trojkat, trojkat.to_numpy(dtype=float)
