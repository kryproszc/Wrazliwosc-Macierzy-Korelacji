import numpy as np
import pandas as pd
from scipy.stats import norm, gamma, lognorm
from scipy.integrate import trapezoid

def crps_dist(y, dist, n_grid=1500):
    """CRPS obliczony numerycznie z dystrybuanty."""

    lo = min(dist.ppf(1e-6), y)
    hi = max(dist.ppf(1 - 1e-6), y)

    if lo == hi:
        return 0.0

    z = np.linspace(lo, hi, n_grid)
    F = dist.cdf(z)

    return trapezoid(
        (F - (z >= y).astype(float))**2,
        z
    )


def compare_crps_incurred(X_I, E_I, h, theta2_I):

    results = []

    for j in range(len(h)):

        for i in range(X_I.shape[0]):

            if j + 1 >= X_I.shape[1]:
                continue

            y = X_I[i, j + 1]
            E = E_I[i, j]

            if not (
                np.isfinite(y)
                and np.isfinite(E)
                and E > 0
                and np.isfinite(h[j])
                and np.isfinite(theta2_I[j])
                and theta2_I[j] > 0
            ):
                continue

            mu = E * h[j]
            sd = np.sqrt(E * theta2_I[j])

            # Normalny
            results.append({
                "rozkład": "normal",
                "CRPS": crps_dist(y, norm(loc=mu, scale=sd))
            })

            # Gamma i lognormalny wymagają dodatniej średniej
            if mu > 0:

                # Gamma – zgodność średniej i wariancji
                shape = (mu / sd)**2
                scale = sd**2 / mu

                results.append({
                    "rozkład": "gamma",
                    "CRPS": crps_dist(
                        y, gamma(a=shape, scale=scale)
                    )
                })

                # Lognormalny – zgodność średniej i wariancji
                s2 = np.log1p((sd / mu)**2)
                s = np.sqrt(s2)
                m = np.log(mu) - s2 / 2

                results.append({
                    "rozkład": "lognormal",
                    "CRPS": crps_dist(
                        y, lognorm(s=s, scale=np.exp(m))
                    )
                })

    return (
        pd.DataFrame(results)
        .groupby("rozkład")["CRPS"]
        .agg(["count", "mean", "median"])
        .sort_values("mean")
    )




wyniki_crps = compare_crps_incurred(
    X_I=X_I,
    E_I=E_I,
    h=h,
    theta2_I=theta2_I
)

display(wyniki_crps)
