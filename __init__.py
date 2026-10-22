import numpy as np
import pandas as pd
from scipy import stats, special

def porownaj_ogony(parametry_6, model="Incurred"):

    p = parametry_6.set_index(["Model", "Rozkład"])

    def get_k(name):
        return float(p.loc[(model, name), "Parametr kształtu"])

    nu = get_k("Student-t")
    kw = get_k("Weibull")
    kl = get_k("Log-logistyczny")

    # Student-t: średnia 0 i wariancja 1
    t_dist = stats.t(
        df=nu,
        scale=np.sqrt((nu - 2) / nu)
    )

    # Weibull: średnia 0 i wariancja 1
    mw = special.gamma(1 + 1/kw)
    sw = np.sqrt(
        special.gamma(1 + 2/kw) - mw**2
    )
    weibull_dist = stats.weibull_min(
        c=kw, loc=-mw/sw, scale=1/sw
    )

    # Log-logistyczny: średnia 0 i wariancja 1
    ml = (np.pi/kl) / np.sin(np.pi/kl)
    vl = ((2*np.pi/kl) / np.sin(2*np.pi/kl)) - ml**2
    sl = np.sqrt(vl)

    loglog_dist = stats.fisk(
        c=kl, loc=-ml/sl, scale=1/sl
    )

    rozklady = {
        "Normalny": stats.norm(),
        "Student-t": t_dist,
        "Weibull": weibull_dist,
        "Log-logistyczny": loglog_dist
    }

    poziomy = [0.95, 0.99, 0.995, 0.999, 0.9999]

    tabela = pd.DataFrame({
        name: [dist.ppf(q) for q in poziomy]
        for name, dist in rozklady.items()
    }, index=poziomy)

    tabela.index.name = "Kwantyl"

    return tabela


print("INCURRED")
display(porownaj_ogony(parametry_6, "Incurred").round(4))

print("REZERWY")
display(porownaj_ogony(parametry_6, "Rezerwy").round(4))
