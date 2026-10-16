import pandas as pd
import numpy as np

def wczytaj_dyskonto(plik, arkusz, hrg):
    df = pd.read_excel(plik, sheet_name=arkusz)

    df = df[
        df["HRG"].astype(str).str.strip() == str(hrg).strip()
    ].copy()

    df["YEAR"] = pd.to_numeric(df["YEAR"])
    df["RATE"] = pd.to_numeric(
        df["RATE"].astype(str).str.replace(",", ".", regex=False)
    )

    df = df.sort_values("YEAR")

    return df[["YEAR", "RATE"]].to_numpy(dtype=float)


discount_factors = wczytaj_dyskonto(
    plik=plik,
    arkusz="discount",
    hrg=2
)

print(discount_factors)
