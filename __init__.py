# Obecna średnia szkoda — przekątna.
X_mean_latest = latest(X_mean_triangle)

# Rozwinięcie trójkąta średniej szkody.
X_mean_full = ultimate(X_mean_triangle, ldf_X_mean)

# Średnia ostateczna — ostatnia kolumna.
X_mean_ult = X_mean_full[:, -1]

# Względna korekta, a nie mnożnik.
IBNER_ratio = np.full(X_mean_latest.shape, np.nan)

np.divide(
    X_mean_ult,
    X_mean_latest,
    out=IBNER_ratio,
    where=X_mean_latest != 0,
)

IBNER_ratio -= 1

display(pd.DataFrame({
    "YEAR": lata,
    "X_mean_latest": X_mean_latest,
    "X_mean_ult": X_mean_ult,
    "IBNER_ratio": IBNER_ratio,
}))
